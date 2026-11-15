# PT-K16 — Go CI'a staticcheck + `@types/smtp-server` kaldırma (devops)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K16 · Bağımlılık: K0, K4, K7, K12 (commit'li).
Uygulama kodu değişmedi. Yeni Action yok, `permissions` aynı, `go.mod`/`go.sum` aynı, iş adı (`check`) aynı (zorunlu durum
denetimi adı bozulmasın diye).

## 1. staticcheck (`.github/workflows/agent-win.yml`, `check` işi)

- `araçlar` adımına `GOFLAGS='' go install honnef.co/go/tools/cmd/staticcheck@v0.8.2` eklendi (govulncheck/go-licenses ile
  aynı desen; modül dışı, `@sürüm` sabit, sum.golang.org doğrular).
- Yeni adım `staticcheck (linux + windows/amd64)`: `staticcheck ./...` ve
  `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 staticcheck ./...`.
- Görevde önerilen `GOOS=windows go run …staticcheck@v0.8.2 ./...` **çalışmaz**: `go run` aracı hedef GOOS için derler,
  linux'ta `fork/exec …/staticcheck.exe: exec format error` verir (yerelde denendi). Bu yüzden araç host için bir kez kurulur,
  hedef GOOS yalnız paket yüklemesini seçer.

Yerel doğrulama (CI ile aynı imaj, repo kökü bağlı):

```sh
docker run --rm -v "$PWD:/src" -w /src/apps/agent-win -e GOTOOLCHAIN=local -e GOFLAGS=-mod=readonly \
  golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
  GOFLAGS="" go install honnef.co/go/tools/cmd/staticcheck@v0.8.2 &&
  staticcheck ./... ; GOOS=windows GOARCH=amd64 CGO_ENABLED=0 staticcheck ./...'
```

Sonuç (çalışma ağacı, 2026-11-15; `staticcheck 2026.2.2 (0.8.2)`):

| Hedef         | Uyarı | Ayrıntı                                                         |
| ------------- | ----- | --------------------------------------------------------------- |
| linux         | 1     | `internal/ui/logo.go:26:6: func orSystemLogo is unused (U1000)` |
| windows/amd64 | 0     | —                                                               |

Tek uyarı K8 kapsamında (K8 şu an düzenliyor, dokunulmadı): `orSystemLogo` HEAD'de yok, K8'in commit'lenmemiş işi. Yapı
etiketsiz `logo.go`'da tanımlı, yalnız `*_windows.go` dosyalarından (`reqwait`, `welcome`, `reqform`) çağrılıyor → linux'ta
kullanılmıyor. K8 düzeltmesi: işlevi bir `_windows.go` dosyasına taşımak (veya `//go:build windows` dosyasına). K8 bitince
iki hedefte 0 uyarı beklenir; o zamana kadar `check` işi bu adımda kırmızı olur. K8 dışındaki paketlerde uyarı yok.

## 2. `@types/smtp-server` kaldırıldı

- `smtp-server@3.21.4` kendi tiplerini taşıyor (`dist/{cjs,esm}/smtp-server.d.ts`). `apps/server/package.json`'dan
  `"@types/smtp-server": "3.5.13"` satırı silindi; `pnpm install --no-frozen-lockfile` → `pnpm-lock.yaml` −18 satır
  (`@types/smtp-server@3.5.13` ve yalnız onun çektiği `@types/nodemailer@8.0.2`). Başka lock değişikliği yok.
- `nodemailer@10.5.0` da kendi tiplerini taşıyor; `tsc --traceResolution` iki modülü de paketin kendi `.d.ts`'ine çözüyor.
- `pnpm --filter @remote/server typecheck` (tsc, `src`+`test` dahil) temiz; `pnpm --filter @remote/server lint` temiz.

## 3. actionlint

`docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -no-color .github/workflows/agent-win.yml` → yalnız
2 adet `SC2015:info` (satır 396, 441; `approve`/`sign` işlerindeki `A && B || C`). İkisi HEAD'de de aynen var
(satır 389/434, +7 kayma bu değişiklikten); yeni bulgu yok. Kapsam dışı olduğu için dokunulmadı.
