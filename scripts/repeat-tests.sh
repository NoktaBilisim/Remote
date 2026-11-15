#!/usr/bin/env bash
# Kararlılık koşusu (P14a, AC-219; mimari-e11 §4.4): entegrasyon + e2e paketlerini <n> kez çalıştırır, kararsız testi
# GİZLEMEZ (retry 0). Kararsız test bulunursa kök neden düzeltilir; docs/implementation.md "Kararsız testler" listesi boş kalır.
#
# Kullanım: scripts/repeat-tests.sh <n> [int|e2e|all]      (varsayılan all)
#   int  vitest entegrasyon (apps/server test:int) <n> AYRI süreçte (her koşu temiz süreç; DB fikstürleri koşu başına
#        rastgele). TEST_DATABASE_URL (+ TEST_MIGRATE_DATABASE_URL) ortamda olmalı (CI test işi; yerelde `eval "$(apps/server/scripts/test-db.sh up)"`, bitince `… down`).
#   e2e  Playwright (apps/web, mock API) tek koşuda `--repeat-each <n> --retries 0` (derleme bir kez).
# Çıktı: koşu başına satır + sonda "SONUÇ: <geçen>/<toplam>"; günlükler REPEAT_LOG_DIR (varsayılan geçici dizin).
# Çıkış 0 = tüm koşular yeşil.
set -uo pipefail
N="${1:-}"; MODE="${2:-all}"
case "$N" in '' | *[!0-9]* | 0) echo "kullanım: $0 <n> [int|e2e|all]" >&2; exit 2 ;; esac
case "$MODE" in int | e2e | all) ;; *) echo "kullanım: $0 <n> [int|e2e|all]" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${REPEAT_LOG_DIR:-$(mktemp -d)}"; mkdir -p "$LOG"
pass=0; total=0; failed=()

if [ "$MODE" != e2e ]; then
  [ -n "${TEST_DATABASE_URL:-}" ] || { echo "HATA: TEST_DATABASE_URL yok (entegrasyon testleri gerçek MySQL ister)" >&2; exit 2; }
  for i in $(seq 1 "$N"); do
    total=$((total + 1)); start=$(date +%s)
    if pnpm --dir "$ROOT" --filter @remote/server exec vitest run test/integration --retry 0 >"$LOG/int-$i.log" 2>&1; then
      pass=$((pass + 1)); echo "PASS  int koşu $i/$N ($(($(date +%s) - start)) sn)"
    else
      failed+=("int-$i"); echo "FAIL  int koşu $i/$N — $LOG/int-$i.log"
      grep -E '(FAIL|×) ' "$LOG/int-$i.log" | head -10 | sed 's/^/      /'
    fi
  done
fi

if [ "$MODE" != int ]; then
  total=$((total + 1)); start=$(date +%s)
  if pnpm --dir "$ROOT" --filter @remote/web exec playwright test --repeat-each "$N" --retries 0 >"$LOG/e2e.log" 2>&1; then
    pass=$((pass + 1)); echo "PASS  e2e --repeat-each $N ($(($(date +%s) - start)) sn)"
  else
    failed+=("e2e"); echo "FAIL  e2e --repeat-each $N — $LOG/e2e.log"
    grep -E '^\s+[0-9]+\) ' "$LOG/e2e.log" | sort | uniq -c | sort -rn | head -20 | sed 's/^/      /'
  fi
fi

echo "SONUÇ: $pass/$total yeşil (günlükler: $LOG)"
[ "${#failed[@]}" = 0 ]
