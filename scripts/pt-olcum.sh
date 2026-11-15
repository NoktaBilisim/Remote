#!/usr/bin/env bash
# PT ölçümü (docs/mimari-temizlik.md §3, PT-K0): dosya boyu, işlev uzunluğu/karmaşıklık, Go staticcheck/deadcode/vet,
# knip, jscpd, ölü i18n, test listeleri, test kapsamı. Repoya kalıcı araç eklemez: knip/jscpd `pnpm dlx` ile (sürüm sabit),
# Go araçları CI ile aynı golang imajında (konteyner silinir). Tek kalıcı bağımlılık @vitest/coverage-v8 (PT-D1).
#
# Kullanım:
#   scripts/pt-olcum.sh <çıktı-dizini> [adım...]   ölçer; özet JSON'ları dizine yazar, Markdown özetini basar
#        adımlar: boyut fonk go knip jscpd i18n testler kapsam  (varsayılan: hepsi; vitest test adları kapsam
#        koşusundan, Go test adları go adımından, `go test -cover` go + kapsam birlikteyken)
#   scripts/pt-olcum.sh karsilastir <eski> <yeni>  iki ölçümü karşılaştırır (K17: docs/temizlik/baseline ↔ yeni ölçüm)
# kapsam: server entegrasyon testleri MySQL ister. TEST_DATABASE_URL (+ TEST_MIGRATE_DATABASE_URL) yoksa betik
#   apps/server/scripts/test-db.sh ile benzersiz adlı geçici konteyner (pt-olcum-<pid>) açar ve sonunda siler.
# Ön koşul: pnpm install --frozen-lockfile && pnpm db:generate; docker. Ölçüm çalışma kopyası üzerinde yapılır.
# Çıkış: 0 tamam · 2 kullanım · diğer: başarısız adımın kodu (testler kırmızıysa kapsam adımı da kırmızıdır).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
H="$ROOT/scripts/pt-olcum"
KNIP=knip@5.88.1
JSCPD=jscpd@4.3.0
STATICCHECK=honnef.co/go/tools/cmd/staticcheck@v0.8.2 # 2026.2.2
DEADCODE=golang.org/x/tools/cmd/deadcode@v0.52.0
GO_IMAGE="golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0" # agent-win.yml ile aynı

if [ "${1:-}" = karsilastir ]; then
  [ $# -eq 3 ] || { echo "kullanım: $0 karsilastir <eski> <yeni>" >&2; exit 2; }
  exec node "$H/ozet.mjs" karsilastir "$2" "$3"
fi
[ $# -ge 1 ] || { sed -n '6,12p' "$0" >&2; exit 2; }
OUT="$(mkdir -p "$1" && cd "$1" && pwd -P)"; shift
STEPS="${*:-boyut fonk go knip jscpd i18n testler kapsam}"
RAW="$(mktemp -d)"
DB_STARTED=""
cleanup() {
  [ -n "$DB_STARTED" ] && TEST_DB_CONTAINER="$DB_STARTED" "$ROOT/apps/server/scripts/test-db.sh" down || true
  rm -rf "$RAW"
}
trap cleanup EXIT
want() { [[ " $STEPS " == *" $1 "* ]]; }
log() { echo "pt-olcum: $*" >&2; }
cd "$ROOT"

if want fonk; then
  log "ESLint işlev uzunluğu (>40, boş/yorum hariç) ve karmaşıklık (>15)"
  for pkg in server web contracts; do
    dir=apps/$pkg; [ $pkg = contracts ] && dir=packages/contracts
    (cd "$dir" && pnpm exec eslint . -f json -o "$RAW/eslint-$pkg.json" \
      --rule '{"max-lines-per-function":["warn",{"max":40,"skipBlankLines":true,"skipComments":true}]}' \
      --rule '{"complexity":["warn",15]}' >/dev/null) || [ -s "$RAW/eslint-$pkg.json" ]
  done
fi

if want go; then
  # Testsiz deadcode yalnız windows: main paketi (cmd/noktadestek) linux'ta derlenmez ("no main packages").
  log "Go: işlev uzunluğu, test adları, vet, staticcheck, deadcode, go test -cover (linux)"
  docker run --rm -v "$ROOT:/src:ro" -v "$H:/olcum:ro" -v "$RAW:/raw" -w /src/apps/agent-win \
    -e GOFLAGS=-buildvcs=false "$GO_IMAGE" bash -c "
      set -e
      (cd /tmp && go run /olcum/golen.go /src/apps/agent-win > /raw/go-fonk.json)
      go install $STATICCHECK && go install $DEADCODE
      for os in linux windows; do
        GOOS=\$os go list -f '{{.ImportPath}}|{{.Dir}}|{{join .TestGoFiles \",\"}}|{{join .XTestGoFiles \",\"}}' ./... > /raw/go-list-\$os.txt
        GOOS=\$os go vet ./... > /raw/vet-\$os.txt 2>&1 || true
        GOOS=\$os staticcheck -f json ./... > /raw/staticcheck-\$os.json || true
        GOOS=\$os deadcode -test ./... > /raw/deadcode-test-\$os.txt
        if [ \$os = windows ]; then GOOS=\$os deadcode ./... > /raw/deadcode-\$os.txt; fi
      done
      $(want kapsam && echo 'go test -count=1 -cover ./... > /raw/go-cover.txt')
    "
fi

if want knip; then
  log "knip ($KNIP)"
  pnpm dlx "$KNIP" --config "$H/knip.json" --reporter json --no-exit-code > "$RAW/knip.json" 2>/dev/null
fi

if want jscpd; then
  log "jscpd ($JSCPD, ≥ 8 satır, ≥ 70 belirteç)"
  pnpm dlx "$JSCPD" --min-lines 8 --min-tokens 70 --reporters json --output "$RAW/jscpd" --silent \
    --ignore '**/node_modules/**,**/generated/**,**/__snapshots__/**,**/*.d.ts' \
    apps/server/src apps/server/test apps/web/app apps/web/components apps/web/lib apps/web/e2e \
    packages/contracts/src packages/contracts/test apps/agent-win/cmd apps/agent-win/internal >/dev/null
fi

if want testler; then
  # vitest test adları kapsam koşusunun JSON raporundan gelir (`vitest list` it.each'i açmaz); burada Playwright + Go (go adımı).
  log "test listesi (playwright --list)"
  (cd apps/web && pnpm exec playwright test --list --reporter=json > "$RAW/playwright.json")
fi

if want kapsam; then
  if [ -z "${TEST_DATABASE_URL:-}" ]; then
    DB_STARTED="pt-olcum-$$"
    log "geçici test MySQL: $DB_STARTED"
    eval "$(TEST_DB_CONTAINER="$DB_STARTED" TEST_DB_PORT="${PT_OLCUM_DB_PORT:-$((34000 + $$ % 1000))}" \
      "$ROOT/apps/server/scripts/test-db.sh" up)"
  fi
  for pkg in contracts web server; do
    dir=apps/$pkg; [ $pkg = contracts ] && dir=packages/contracts
    log "kapsam: $pkg (vitest v8)"
    (cd "$dir" && rm -rf coverage && pnpm run --silent test:cov --reporter=default --reporter=json \
      --outputFile.json="$RAW/vitest-$pkg.json" > "$RAW/kapsam-$pkg.log" 2>&1) ||
      { tail -30 "$RAW/kapsam-$pkg.log" >&2; exit 1; }
    cp "$dir/coverage/coverage-summary.json" "$RAW/kapsam-$pkg.json"
  done
fi

node "$H/ozet.mjs" topla "$ROOT" "$RAW" "$OUT"
pnpm exec prettier --log-level warn --write "$OUT"/*.json
log "tamam: $OUT"
