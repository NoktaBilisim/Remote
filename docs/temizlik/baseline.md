# PT baseline ölçümü (PT-K0)

Tarih: 2026-11-15 · Ölçülen kod: **`c661ea0`** (P20 + PT-K1; diğer PT görevlerinin yarım değişiklikleri hariç — ayrı
`git worktree` kopyasında ölçüldü) · Betik: `scripts/pt-olcum.sh` · Ayrıntılı veri: `docs/temizlik/baseline/*.json`
Tasarım: `docs/mimari-temizlik.md` §3 (yöntem), §5 (hedef listesi), §7 (AC-317..324 kanıt eşlemesi).

## Nasıl tekrarlanır (K17 ve sonraki paketler)

```bash
pnpm install --frozen-lockfile && pnpm db:generate
scripts/pt-olcum.sh /tmp/pt-son                         # tüm adımlar (~10 dk; geçici MySQL'i kendisi açar/siler)
scripts/pt-olcum.sh karsilastir docs/temizlik/baseline /tmp/pt-son   # Markdown tablo + test listesi farkı (AC-317)
```

Adım seçilebilir: `scripts/pt-olcum.sh <dizin> boyut fonk go knip jscpd i18n testler kapsam`. Vitest test adları kapsam
koşusundan gelir (`vitest list` statik çözümleyicisi kullanılmadı: `it.each`'i açmıyor ve `findMany({ where … })` gibi
çağrıları test sanıyor). Ölçüm, başka görevlerin yarım değişiklikleri varken ayrı bir worktree'de yapılmalıdır.

Araç sürümleri (sabit, repoya girmez): knip 5.88.1 ve jscpd 4.3.0 (`pnpm dlx`), staticcheck 2026.2.2 (v0.8.2) ve
deadcode (x/tools v0.52.0) `golang:1.26.11-bookworm@sha256:dc40…` (agent-win.yml ile aynı) konteynerinde, Go işlev
uzunluğu `scripts/pt-olcum/golen.go` (go/ast), ESLint mevcut yapılandırma + CLI kuralı
(`max-lines-per-function` 40 boş/yorum hariç, `complexity` 15). Kapsam: `@vitest/coverage-v8` 5.1.0 (PT-D1),
`go test -cover` (linux).

## Özet sayılar

### Dosya boyutu (üretim)

| Alan                                | Dosya |  Satır | > 300 | > 500 |
| ----------------------------------- | ----: | -----: | ----: | ----: |
| `apps/server/src`                   |   128 | 24 555 |    24 |     8 |
| `apps/web` (app + components + lib) |   292 | 32 986 |    20 |     3 |
| `packages/contracts/src`            |    22 |  5 814 |     9 |     1 |
| `apps/agent-win` (`_test.go` hariç) |   108 | 20 887 |    25 |     8 |

Test dosyaları > 300 / > 500: server 30 / 11, web (lib testleri + e2e) 26 / 2, contracts 0 / 0, Go 16 / 6.

> 500 üretim: §3.1 listesiyle aynı + `launch/home.go` 565, `remember/remember.go` 510 (P20 sonrası sınırı geçti).
> Not: web dosya sayısı yalnız `.ts/.tsx/.mjs` (mimari §3.1'deki 335, yöntem farkı); satır sayısı `wc -l` ile aynı.

### İşlev uzunluğu ve karmaşıklık (üretim)

| Alan      | > 40 | > 80 | > 150 | cx > 15 | En kötüler                                                                |
| --------- | ---: | ---: | ----: | ------: | ------------------------------------------------------------------------- |
| server    |   99 |   23 |     6 |      42 | `createCore` 264, `buildApp` 259, `attachSignaling` 254; cx 48, 43, 34    |
| web       |  174 |   95 |    35 |      66 | `SettingsForm` 440, `RequestQueue` 364, `ImportWizard` 340; `Stage` cx 87 |
| contracts |    0 |    0 |     0 |       2 | —                                                                         |
| Go (1004) |   53 |    7 |     1 |       — | `run` 175, `UI.FirmHome` 132, `UI.ChooseShare` 129, `runner.form` 99      |

Testlerde > 40: server 244, web 91, contracts 12, Go 29. Tam liste (dosya, satır, ad, değer): `fonksiyon.json`,
`go.json` `fonk.*.uzun`.

### Ölü kod, kopya, statik analiz

| Ölçüt                                     | Baseline                                                                                                           | Not                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| knip kullanılmayan export (üretim)        | server 96 · web 101 = 197                                                                                          | test/e2e yardımcıları ayrı: server-test 1, web-test 16                                             |
| knip kullanılmayan dışa açık tip (üretim) | server 83 · web 72 = 155                                                                                           | test: server-test 6, web-test 1                                                                    |
| knip diğer                                | 1 duplicate (contracts), `@prisma/client` + `@types/smtp-server` bağımlılık, 2 unlisted (`postcss`, `server-only`) | §3.3 ile aynı yorum                                                                                |
| Go deadcode (windows, testler dahil)      | 3                                                                                                                  | `SameRegistration` + 2 test sahtesi yöntemi (`select_test.go`)                                     |
| Go yalnız testte erişilen üretim işlevi   | 7                                                                                                                  | §3.3 listesiyle birebir                                                                            |
| Go staticcheck (linux = windows)          | 10                                                                                                                 | 9× ST1018 + 1× S1017, hepsi `_test.go`                                                             |
| go vet (linux, windows)                   | 0, 0                                                                                                               |                                                                                                    |
| jscpd (≥ 8 satır, ≥ 70 belirteç)          | 70 klon / 972 satır                                                                                                | üretim **25 klon / 418 satır**, test 45                                                            |
| i18n ölü aday                             | **27** / 2 007 anahtar                                                                                             | + 145 "dinamik aday" (40 şablon önekinden biriyle başlıyor; tek tek doğrulanmadan silinmez, R-PT5) |

**AC-321 sayımı hakkında:** mimari §3.3 "93 + 93" (server + web) yazıyor; bu yapılandırmayla (`scripts/pt-olcum/knip.json`,
vitest eklentisi kapalı, test/e2e giriş) üretim sayısı **197 + 155**. Fark yöntemden (mimari ölçümün yapılandırması
repoda yok). K17 karşılaştırması bu betikle yapılmalı; AC-321 hedefinin (93'ten oransal düşüş) bu baseline'a
uyarlanması mimarın kararıdır (açık nokta, aşağıda).

### Testler (AC-317) ve kapsam (AC-319)

| Paket               |                                                    Test sayısı (hepsi geçti) |                                 Satır % | Dal % | İşlev % | İfade % |
| ------------------- | ---------------------------------------------------------------------------: | --------------------------------------: | ----: | ------: | ------: |
| server (unit + int) |                                                                        1 230 |                                   94,87 | 86,69 |   93,77 |   92,18 |
| web (vitest, lib)   |                                                                          386 |                                   64,09 | 66,49 |   64,41 |   63,36 |
| contracts           |                                                                          142 |                                   86,27 | 60,75 |   70,95 |   84,11 |
| Playwright (liste)  |                                                                          643 |                                       — |     — |       — |       — |
| Go linux / windows  | 397 / 423 (`func Test…` adı; 398/424 Benchmark dahil sayımdı, bkz. sonuc.md) | paket başına `kapsam.json` (78,3 – 100) |

Kapsam kapsamı: server `src/**`, web `lib/**`, contracts `src/**` (testi olmayan dosyalar %0 olarak dahil). Go yalnız
linux (Windows'a özgü dosyalar ölçülmez; Windows CI testleri koşar).

**Gürültü:** aynı kod iki kez ölçüldüğünde server kapsamı ±0,05 puan, Go `internal/flow` ±0,2 puan oynadı (zamanlamaya
bağlı dallar). K17'de "düşmedi" kararı bu aralık göz önünde tutularak verilmeli.

## graphify çapraz kontrolü (§3.7-3)

Kaynak `graphify-out/graph.json` (yerel, git dışı). Yöntem: üretim kaynak dosyasındaki kod düğümü, derece ≤ 1
(yalnız tanımlandığı dosyaya bağlı) = zayıf. graphify raporundaki "261 isolated" sayısı paket adı/kavram düğümlerini de
içerdiği için kod düzeyinde yeniden hesaplandı: **1 122 zayıf düğüm**, bunlardan **185'i knip veya deadcode ile teyitli**.
Teyitsiz 937 düğüm (çoğu dosya-içi tip/yardımcı; graf kenarı eksik) "doğrulandı, kullanılıyor" sayılır, silinmez.
Ayrıntı (teyitli liste görev başına): `baseline/graphify-capraz.json`.

| Görev                   | Zayıf | Teyitli (silinecek / `export` kaldırılacak aday) | Görevin tüm knip/deadcode bulgusu               |
| ----------------------- | ----: | -----------------------------------------------: | ----------------------------------------------- |
| K4                      |    21 |                                                0 | —                                               |
| K5                      |     8 |                                                0 | deadcode 1 (`SameRegistration`)                 |
| K6                      |    27 |                                                0 | —                                               |
| K7                      |    18 |                                                2 | yalnız testte 3                                 |
| K8                      |    12 |                                                0 | yalnız testte 4 (`ui/theme.go` kontrast)        |
| K9                      |    93 |                                               22 | export 21, tip 8                                |
| K10                     |    35 |                                               12 | export 12, tip 8                                |
| K11                     |    97 |                                               26 | export 15, tip 17                               |
| K12                     |   254 |                                               62 | export 48, tip 50                               |
| K13                     |    30 |                                                5 | export 11, tip 11                               |
| K14                     |    66 |                                               22 | export 19, tip 15                               |
| K15                     |   148 |                                               34 | export 71, tip 46                               |
| contracts (kapsam dışı) |   230 |                                                0 | —                                               |
| §3.7-4 dokunulmaz       |     5 |                                                0 | —                                               |
| atanmamış               |    78 |                                                0 | test yardımcıları / e2e sahte API (kapsam dışı) |

## Açık noktalar (mimar)

1. AC-321 eşiği "93 + 93" mimarın ölçüm yapılandırmasına göre yazılmış; bu baseline'da 197 + 155. Hedef oranı
   korunarak bu sayılara uyarlanması önerilir.
2. i18n "dinamik aday" 145 (mimari 14): önek listesi geniş (`r.`, `t.`, `c.` gibi); K15 her adayı grep ile tek tek
   doğrular.
